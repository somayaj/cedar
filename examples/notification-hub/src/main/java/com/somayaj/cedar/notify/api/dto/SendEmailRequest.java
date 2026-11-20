package com.somayaj.cedar.notify.api.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record SendEmailRequest(
    @Email @NotBlank String to,
    @NotBlank String template,
    @NotBlank String subject
) {}