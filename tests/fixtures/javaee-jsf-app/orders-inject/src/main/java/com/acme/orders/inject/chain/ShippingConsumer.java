package com.acme.orders.inject.chain;

import javax.inject.Inject;

interface Shipping {
}

abstract class AbstractShipping implements Shipping {
}

class GroundShipping extends AbstractShipping {
}

interface Tax {
}

interface Taxable extends Tax {
}

class FlatTax implements Taxable {
}

interface Pricing {
}

class BasePricing implements Pricing {
}

class PremiumPricing extends BasePricing {
}

public class ShippingConsumer {
    @Inject
    private Shipping shipping;

    @Inject
    private Tax tax;

    @Inject
    private Pricing pricing;
}
