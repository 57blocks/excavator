package com.acme.orders.inject.producers;

import javax.enterprise.inject.Produces;
import javax.inject.Inject;
import javax.inject.Provider;

interface Repo {
}

class RepoProducers {
    @Produces
    public Repo repo() {
        return null;
    }
}

interface Cache {
}

class CacheProducers {
    @Produces
    Cache cache;
}

interface Token {
}

class TokenProvider implements Provider<Token> {
    public Token get() {
        return null;
    }
}

public class RepoConsumer {
    @Inject
    private Repo repo;

    @Inject
    private Cache cache;

    @Inject
    private Token token;
}
