package com.somayaj.cedar.payment.domain;

import java.util.UUID;

public record CheckoutSession(String id, long amountCents, String currency) {

  public static CheckoutSession create(long amountCents, String currency) {
    return new CheckoutSession(UUID.randomUUID().toString(), amountCents, currency);
  }
}