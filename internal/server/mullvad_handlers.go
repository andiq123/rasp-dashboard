package server

import (
	"context"
	"net/http"

	"firewifi/dashboard/internal/state"
)

// MullvadAccountStore is implemented by the state reader; kept optional so
// tests can use a plain StateReader.
type MullvadAccountStore interface {
	ReadMullvadAccount() state.MullvadAccount
	SetMullvadAccount(ctx context.Context, number string) (state.MullvadAccount, error)
	ClearMullvadAccount() error
}

func (s *Server) handleMullvadAccount(w http.ResponseWriter, r *http.Request) {
	store, ok := s.State.(MullvadAccountStore)
	if !ok {
		http.Error(w, "Mullvad account tracking is not available", http.StatusNotImplemented)
		return
	}
	switch r.Method {
	case http.MethodGet:
		jsonReply(w, store.ReadMullvadAccount())
	case http.MethodPost:
		var body struct {
			AccountNumber string `json:"account_number"`
		}
		if err := decodeJSONBody(r, &body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		acct, err := store.SetMullvadAccount(r.Context(), body.AccountNumber)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, acct)
	case http.MethodDelete:
		if err := store.ClearMullvadAccount(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonReply(w, state.MullvadAccount{})
	default:
		methodNotAllowed(w)
	}
}
