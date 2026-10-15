package com.acme.orders.inject.unique;

import javax.ejb.EJB;

public class GreetingLookup {
    @EJB(beanInterface = Greeter.class)
    private Object typed;

    @EJB(beanName = "GreeterBean")
    private Greeter named;

    @EJB(lookup = "java:global/orders/Greeter")
    private Greeter looked;
}
