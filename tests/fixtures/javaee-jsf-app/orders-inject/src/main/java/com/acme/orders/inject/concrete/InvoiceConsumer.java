package com.acme.orders.inject.concrete;

import javax.ejb.EJB;

class InvoiceService {
}

public class InvoiceConsumer {
    @EJB
    private InvoiceService invoices;
}
