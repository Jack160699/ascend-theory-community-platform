/**
 * Phase 7 — OTP Send Provider Abstraction (Requirement #10)
 */

export interface OTPDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface OTPTransportProvider {
  readonly providerName: string;
  sendOtp(phoneNormalized: string, otpText: string): Promise<OTPDeliveryResult>;
}

export class MockOTPTransportProvider implements OTPTransportProvider {
  readonly providerName = "mock_sms_gateway";
  public lastSentOtp?: { phone: string; otpText: string };

  async sendOtp(phoneNormalized: string, otpText: string): Promise<OTPDeliveryResult> {
    this.lastSentOtp = { phone: phoneNormalized, otpText };
    return {
      success: true,
      messageId: `mock-msg-${Date.now()}`,
    };
  }
}

export class ProductionDisabledOTPTransportProvider implements OTPTransportProvider {
  readonly providerName = "production_sms_disabled";

  async sendOtp(_phoneNormalized: string, _otpText: string): Promise<OTPDeliveryResult> {
    return {
      success: false,
      error: "transport_unavailable: real SMS provider network transport disabled in Phase 7",
    };
  }
}

/**
 * Resolves active OTP transport provider based on configuration.
 */
export function getOTPTransportProvider(): OTPTransportProvider {
  if (process.env.NODE_ENV === "test" || process.env.ENABLE_MOCK_OTP === "true") {
    return new MockOTPTransportProvider();
  }
  return new ProductionDisabledOTPTransportProvider();
}
