package com.acme.orders.rest;

import javax.ws.rs.*;

public class ItemResource {

    @GET
    public String list() {
        return "[]";
    }

    @GET
    @Path("{n}")
    public String one(@PathParam("n") int n) {
        return "";
    }
}
