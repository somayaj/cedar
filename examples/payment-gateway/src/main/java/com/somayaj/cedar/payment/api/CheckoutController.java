package com.somayaj.cedar.payment.api;

import com.somayaj.cedar.payment.domain.CheckoutSession;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/checkout")
public class CheckoutController {

  @PostMapping("/sessions")
  public ResponseEntity<Map<String, Object>> createSession(
      @RequestParam(defaultValue = "1000") long amountCents,
      @RequestParam(defaultValue = "usd") String currency
  ) {
    CheckoutSession session = CheckoutSession.create(amountCents, currency);
    return ResponseEntity.ok(Map.of(
        "sessionId", session.id(),
        "amountCents", session.amountCents(),
        "currency", session.currency()
    ));
  }
}