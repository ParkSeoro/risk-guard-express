import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmergencyAlertBanner } from "@/components/messenger/EmergencyAlertBanner";

describe("EmergencyAlertBanner", () => {
  it("renders emergency banner with title and description", () => {
    render(
      <EmergencyAlertBanner
        title="🚨 긴급 작업중지"
        description="악천후로 인한 타워크레인 작업중지"
      />,
    );
    expect(screen.getByText("🚨 긴급 작업중지")).toBeDefined();
    expect(screen.getByText("악천후로 인한 타워크레인 작업중지")).toBeDefined();
  });

  it("triggers onAction when action button is clicked", () => {
    const handleAction = vi.fn();
    render(
      <EmergencyAlertBanner
        title="비상 경보"
        actionLabel="대피로 확인"
        onAction={handleAction}
      />,
    );
    const btn = screen.getByText("대피로 확인");
    fireEvent.click(btn);
    expect(handleAction).toHaveBeenCalledOnce();
  });

  it("dismisses banner when close button is clicked", () => {
    render(<EmergencyAlertBanner title="테스트 경보" />);
    const closeBtn = screen.getByLabelText("경보 닫기");
    fireEvent.click(closeBtn);
    expect(screen.queryByText("테스트 경보")).toBeNull();
  });
});
