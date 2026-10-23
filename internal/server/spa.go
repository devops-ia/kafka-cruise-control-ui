package server

import (
	"bytes"
	"html"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spa serves the embedded files and falls back to index.html for client-side routes (paths without an extension).
// Directories are never listed. A non-empty logo replaces the built-in icon link, which the SPA also reads for its brand.
func spa(files fs.FS, logo string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" {
			if st, err := fs.Stat(files, name); err == nil && !st.IsDir() {
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				http.ServeFileFS(w, r, files, name)
				return
			}
			if strings.Contains(path.Base(name), ".") {
				http.NotFound(w, r)
				return
			}
		}
		index, err := fs.ReadFile(files, "index.html")
		if err != nil {
			http.Error(w, "web assets are not built", http.StatusNotFound)
			return
		}
		// The CSP allows only scripts carrying this request's nonce.
		index = bytes.ReplaceAll(index, []byte("<script"), []byte(`<script nonce="`+nonceFrom(r.Context())+`"`))
		if logo != "" {
			index = bytes.Replace(index, []byte(`href="/logo.svg"`), []byte(`href="`+html.EscapeString(logo)+`"`), 1)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(index)
	})
}
