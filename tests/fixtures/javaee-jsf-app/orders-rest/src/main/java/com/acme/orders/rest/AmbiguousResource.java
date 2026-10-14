package com.acme.orders.rest;

import javax.ws.rs.*;
import jakarta.ws.rs.*;

@Path("/ambiguous")
public class AmbiguousResource {

    @GET
    public String which() {
        return "";
    }
}
