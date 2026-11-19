package main

import "github.com/gin-gonic/gin"

func setupTestRouter() *gin.Engine {
	r := gin.New()
	r.GET("/test-only", nil)
	return r
}
