package status

var statusText = map[Status]string{
	StatusDraft:            "Draft",
	StatusSubmitted:        "Submitted",
	StatusRejected.Uint8(): "Rejected",
	StatusNowhere:          "Nowhere",
	StatusApproved:         `Approved`,
}

var counts = map[Status]int{
	StatusDraft: 1,
}

var plain = map[string]string{
	"draft": "not a reference",
}

// var commented = map[Status]string{ StatusDraft: "Commented" }
