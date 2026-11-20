package com.somayaj.cedar.notify.api;

import com.somayaj.cedar.notify.api.dto.SendEmailRequest;
import com.somayaj.cedar.notify.domain.EmailComposer;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/emails")
public class EmailController {

  private final EmailComposer composer;

  public EmailController(EmailComposer composer) {
    this.composer = composer;
  }

  @PostMapping
  public ResponseEntity<Map<String, String>> send(@Valid @RequestBody SendEmailRequest request) {
    String body = composer.renderBody(request.template(), request.subject());
    return ResponseEntity.accepted().body(Map.of(
        "status", "queued",
        "deliveryId", composer.deliveryId(request.to()),
        "preview", body.lines().findFirst().orElse("")
    ));
  }
}