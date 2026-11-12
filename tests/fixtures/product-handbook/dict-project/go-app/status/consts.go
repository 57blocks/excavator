package status

const (
	// StatusDraft is the initial state.
	StatusDraft Status = iota + 1 // created by the user
	// waiting for the first approval
	StatusSubmitted
	// this comment is separated by a blank line

	StatusApproved
	StatusRejected
	StatusLegacy Status = legacyBase + 1
)

const (
	KindInternal Kind = "internal"
	KindExternal Kind = "external"
	KindOther    = KindInternal
)

const (
	LevelLow Level = 1 << iota
	LevelMid
	LevelHigh
)

const (
	FlagA Flags = 1 << (iota + 2)
	FlagB
	FlagC /* the third flag */
)

const (
	_ Phase = iota
	PhaseOne
	PhaseTwo
)
