package com.acme.orders.inject.business;

import javax.ejb.EJB;
import javax.ejb.Local;
import javax.ejb.Stateless;

interface Quote {
}

@Stateless
@Local(Quote.class)
class QuoteBean {
}

public class QuoteConsumer {
    @EJB
    private Quote quote;
}
