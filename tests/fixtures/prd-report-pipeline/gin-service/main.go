package main

import (
	"example.test/ginsvc/internal/handlers"
	"example.test/ginsvc/internal/jobs"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	api := r.Group("/api")
	api.GET("/users", handlers.ListUsers)
	api.POST("/users", handlers.CreateUser)
	api.Any("/ping", handlers.Ping)
	r.Handle("PATCH", "/users/:id", handlers.UpdateUser)
	jobs.Start()
	_ = r.Run()
}
