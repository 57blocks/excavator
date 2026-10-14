package com.acme.orders.rest;

@javax.ws.rs.Path("/qualified")
public class QualifiedResource {

    @javax.ws.rs.PUT
    @javax.ws.rs.Path("{id}")
    public void replace(@javax.ws.rs.PathParam("id") long id) {
    }
}
