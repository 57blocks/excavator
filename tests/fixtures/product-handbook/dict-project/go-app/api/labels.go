package api

import "example.com/go-app/status"

var labels = map[status.Status]string{
	status.StatusDraft:            "Draft (api)",
	status.StatusApproved.Uint8(): "Approved (api)",
	status.StatusMissing:          "Missing (api)",
	other.StatusDraft:             "Other",
}
