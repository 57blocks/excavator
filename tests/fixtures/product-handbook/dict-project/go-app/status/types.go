package status

// Status is the state of an order.
type Status int

type (
	Kind  string
	Level uint8
	Flags uint16
	Phase int32
)

type Lonely string

type Holder struct {
	Name string
}

// type Fake int
const note = "type Ghost string"
