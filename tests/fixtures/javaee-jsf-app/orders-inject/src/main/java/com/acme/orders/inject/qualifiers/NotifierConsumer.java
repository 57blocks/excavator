package com.acme.orders.inject.qualifiers;

import javax.inject.Inject;
import javax.persistence.EntityManager;
import org.eclipse.microprofile.rest.client.inject.RestClient;

interface Notifier {
}

class EmailNotifier implements Notifier {
}

public class NotifierConsumer {
    @Inject
    private EntityManager manager;

    @Inject
    @RestClient
    private Notifier remote;
}
