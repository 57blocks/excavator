package status

type Mode = uint8

type (
	Tier  = string
	Count = int
)

type Same = Status

const (
	ModeOff Mode = iota
	ModeOn
)

const (
	TierGold   Tier = "gold"
	TierSilver Tier = "silver"
)
