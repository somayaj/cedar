package com.somayaj.cedar.notify.domain;

import org.springframework.stereotype.Service;

@Service
public class EmailComposer {

  public String renderBody(String template, String subject) {
    return "template=" + template + "\nsubject=" + subject + "\nbody=Hello from notification-hub";
  }

  public String deliveryId(String to) {
    return "notify-" + Math.abs(to.hashCode());
  }
}