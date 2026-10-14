package com.acme.orders.rest;

import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.Path;

@Path("/v2/orders")
public interface OrderApi {

    @GET
    String list();

    @POST
    void create(String body);
}
