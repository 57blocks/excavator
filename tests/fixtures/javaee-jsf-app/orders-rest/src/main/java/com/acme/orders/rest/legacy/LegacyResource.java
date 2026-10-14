package com.acme.orders.rest.legacy;

import javax.ws.rs.*;

@Path("/legacy")
public class LegacyResource {

    @GET
    public String ping() {
        return "pong";
    }
}
