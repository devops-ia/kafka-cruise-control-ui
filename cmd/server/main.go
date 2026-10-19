// Command server runs the Cruise Control UI: an embedded SPA plus an authenticated reverse proxy.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/server"
	"github.com/devops-ia/kafka-cruise-control-ui/web"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe /healthz on the local listener and exit (for the container HEALTHCHECK)")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load(config.FromEnviron(os.Environ()))
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid configuration:\n%v\n", err)
		os.Exit(1)
	}
	if *healthcheck {
		os.Exit(probe(cfg))
	}
	cfg.Log(log)

	h, err := server.New(server.Deps{Config: cfg, Web: web.Dist(), Log: log})
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot start: %v\n", err)
		os.Exit(1)
	}
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	if cfg.TLSEnabled() {
		srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	log.Info("listening", "addr", cfg.Listen, "tls", cfg.TLSEnabled())
	if cfg.TLSEnabled() {
		err = srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
	} else {
		err = srv.ListenAndServe()
	}
	if !errors.Is(err, http.ErrServerClosed) {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func probe(cfg *config.Config) int {
	_, port, err := net.SplitHostPort(cfg.Listen)
	if err != nil {
		return 1
	}
	scheme := "http"
	client := &http.Client{Timeout: 3 * time.Second}
	if cfg.TLSEnabled() {
		scheme = "https"
		// Loopback probe of our own certificate, which is usually issued for the public name.
		client.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	}
	resp, err := client.Get(scheme + "://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
