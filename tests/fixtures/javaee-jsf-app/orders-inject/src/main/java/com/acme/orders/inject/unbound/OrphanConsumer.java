package com.acme.orders.inject.unbound;

import javax.inject.Inject;

interface Orphan {
}

public class OrphanConsumer {
    @Inject
    private Orphan orphan;
}
