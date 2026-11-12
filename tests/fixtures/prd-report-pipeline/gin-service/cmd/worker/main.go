package main

import "example.test/ginsvc/internal/jobs"

func main() {
	jobs.Start()
	select {}
}
