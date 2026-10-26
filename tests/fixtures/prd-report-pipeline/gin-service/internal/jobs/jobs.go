package jobs

import "github.com/robfig/cron/v3"

// Start registers the hourly sweep.
func Start() {
	c := cron.New()
	_, _ = c.AddFunc("@every 1h", sweep)
	c.Start()
}

func sweep() {}
