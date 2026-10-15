package com.acme.orders.inject.deployment;

import javax.enterprise.inject.Alternative;
import javax.inject.Inject;

interface Discount {
}

@Alternative
class SeasonalDiscount implements Discount {
}

public class DiscountConsumer {
    @Inject
    private Discount discount;
}
