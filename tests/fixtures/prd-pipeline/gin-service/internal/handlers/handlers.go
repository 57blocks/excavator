package handlers

import "github.com/gin-gonic/gin"

func ListUsers(c *gin.Context)  { c.JSON(200, []string{}) }
func CreateUser(c *gin.Context) { c.Status(201) }
func Ping(c *gin.Context)       { c.String(200, "pong") }
func UpdateUser(c *gin.Context) { c.Status(204) }
