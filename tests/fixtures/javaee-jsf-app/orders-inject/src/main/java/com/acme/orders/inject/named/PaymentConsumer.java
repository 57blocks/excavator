package com.acme.orders.inject.named;

import javax.enterprise.inject.Model;
import javax.inject.Inject;
import javax.inject.Named;

interface Payment {
}

@Named("card")
class CardPayment implements Payment {
}

@Named
class CashPayment implements Payment {
}

@Model
class VoucherPayment implements Payment {
}

public class PaymentConsumer {
    @Inject
    @Named("card")
    private Payment card;

    @Inject
    @Named("cashPayment")
    private Payment cash;

    @Inject
    @Named("voucherPayment")
    private Payment voucher;

    @Inject
    private Payment any;
}
