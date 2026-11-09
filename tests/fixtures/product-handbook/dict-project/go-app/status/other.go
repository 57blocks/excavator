package status

import "time"

const legacyBase = 100

const (
	retryNone = iota
	retryOnce
)

const Deadline time.Duration = 5
const MaxItems int = 3
