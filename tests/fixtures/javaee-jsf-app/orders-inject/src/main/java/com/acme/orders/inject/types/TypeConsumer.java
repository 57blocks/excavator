package com.acme.orders.inject.types;

import javax.inject.Inject;

public class TypeConsumer {
    @Inject
    private Holder.Part part;

    @Inject
    private Twin twin;

    static class Inner {
        @Inject
        private Twin inner;
    }
}
