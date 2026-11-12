package status

type Tone string
type Shade uint8

var (
	ToneWarm  Tone  = "warm"
	ToneCold  Tone  = "cold"
	ToneMix   Tone  = pick()
	ShadeDark Shade = 1
	ShadeBad  Shade = iota
)

var ShadeLight Shade = 2

var Plain = "x"

var Handle time.Duration = 5

var Unset Shade
