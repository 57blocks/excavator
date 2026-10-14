package com.acme.orders.rest;

import javax.ws.rs.GET;
import javax.ws.rs.Path;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

@RegisterRestClient
@Path("/library")
public interface LibraryClient {

    @GET
    String books();
}
