package com.acme.orders.rest;

import javax.ws.rs.*;
import javax.ws.rs.core.MediaType;

@Path("/orders/")
public class OrderResource {

    @GET
    public String list() {
        return "[]";
    }

    @GET
    @Path("{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public String findJson(@PathParam("id") long id) {
        return "{}";
    }

    @GET
    @Path("{id}")
    @Produces(MediaType.TEXT_PLAIN)
    public String findText(@PathParam("id") long id) {
        return "order";
    }

    @GET
    @Path("{code: [A-Z]{3}-[0-9]+}/")
    public String byCode(@PathParam("code") String code) {
        return code;
    }

    @GET
    @Path("/files/{path: .+/[^/]*}/")
    public String file(@PathParam("path") String path) {
        return path;
    }

    @POST
    public void create(String body) {
    }

    @DELETE
    @Path("/{id}/")
    public void remove(@PathParam("id") long id) {
    }

    @GET
    @Path(OrderPaths.HISTORY)
    public String history() {
        return "[]";
    }

    @GET
    @POST
    @Path("sync")
    public void sync() {
    }

    @Path("{id}/items")
    public ItemResource items(@PathParam("id") long id) {
        return new ItemResource();
    }

    @GET
    @Path("secret")
    private String secret() {
        return "";
    }

    public static class Summary {
        @GET
        @Path("summary")
        public String summary() {
            return "";
        }
    }
}
