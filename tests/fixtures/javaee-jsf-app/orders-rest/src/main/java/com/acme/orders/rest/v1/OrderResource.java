package com.acme.orders.rest.v1;

import javax.ws.rs.GET;
import javax.ws.rs.Path;

@Path("/orders")
public class OrderResource {

    @GET
    public String list() {
        return "[]";
    }
}
