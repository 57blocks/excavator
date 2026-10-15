package com.acme.orders.inject.unique;

import javax.inject.Inject;

interface Greeter {
}

class GreeterImpl implements Greeter {
}

public class GreetingConsumer {
    @Inject
    private Greeter greeter;
}
