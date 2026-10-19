package auth

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// limiter counts failures per key. After max failures inside window the key is blocked until the window,
// measured from the first failure, ends. State is in memory, like sessions.
type limiter struct {
	max    int
	window time.Duration
	mu     sync.Mutex
	m      map[string]*attempts
}

type attempts struct {
	fails int
	first time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{max: max, window: window, m: map[string]*attempts{}}
}

// blocked reports how long the key must wait.
func (l *limiter) blocked(key string, now time.Time) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.m[key]
	if a == nil {
		return 0, false
	}
	if now.Sub(a.first) >= l.window {
		delete(l.m, key)
		return 0, false
	}
	if a.fails >= l.max {
		return l.window - now.Sub(a.first), true
	}
	return 0, false
}

func (l *limiter) fail(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.m) > 10000 { // bound memory against spraying many usernames
		for k, a := range l.m {
			if now.Sub(a.first) >= l.window {
				delete(l.m, k)
			}
		}
	}
	if a := l.m[key]; a != nil && now.Sub(a.first) < l.window {
		a.fails++
	} else {
		l.m[key] = &attempts{fails: 1, first: now}
	}
}

func (l *limiter) reset(key string) {
	l.mu.Lock()
	delete(l.m, key)
	l.mu.Unlock()
}

// clientIP is the peer address, or the last X-Forwarded-For entry (the one our own proxy appended) when trusted.
func clientIP(r *http.Request, trustXFF bool) string {
	if trustXFF {
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
