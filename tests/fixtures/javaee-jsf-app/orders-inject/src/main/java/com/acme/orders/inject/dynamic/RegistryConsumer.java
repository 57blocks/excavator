package com.acme.orders.inject.dynamic;

import javax.inject.Inject;

interface Registry {
}

class RegistryImpl implements Registry {
}

class RegistryModule {
    Object type = Registry.class;
}

public class RegistryConsumer {
    @Inject
    private Registry registry;
}
