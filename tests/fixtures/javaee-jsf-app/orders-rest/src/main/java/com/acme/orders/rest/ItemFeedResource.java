package com.acme.orders.rest;

import jakarta.ws.rs.*;

@Path("items")
public class ItemFeedResource {

    @GET
    public String feed() {
        return "[]";
    }

    @DELETE
    @Path("{id}")
    public void remove(@PathParam("id") long id) {
    }
}
