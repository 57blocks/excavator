package com.acme.orders.inject.wiring;

import javax.ejb.EJB;
import javax.inject.Inject;

public class Positioned {
    @EJB
    public Positioned(Clock clock) {
    }

    @EJB
    public void setBoth(Clock clock, Mailer mailer) {
    }

    // Two methods on one line: no declaration of the row is the one the annotation is on.
    @Inject
    public void put(Clock clock) { } public void put(Mailer mailer) { }
}
