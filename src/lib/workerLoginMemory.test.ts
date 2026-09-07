import { beforeEach, describe, expect, it } from "vitest";
import {
  WORKER_LOGIN_MEMORY_KEY,
  clearWorkerLoginMemory,
  loadWorkerLoginMemory,
  rememberWorkerLoginOnDevice,
  saveWorkerLoginMemory,
  workerLoginPrefill,
} from "@/lib/workerLoginMemory";

describe("workerLoginMemory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves phone and PIN when remember is on", () => {
    saveWorkerLoginMemory({ phone: "010-1234-5678", pin: "1234", rememberPin: true });
    expect(loadWorkerLoginMemory()).toEqual({
      phone: "01012345678",
      pin: "1234",
      rememberPin: true,
    });
  });

  it("keeps the phone but drops PIN when remember is off", () => {
    saveWorkerLoginMemory({ phone: "01012345678", pin: "1234", rememberPin: false });
    expect(loadWorkerLoginMemory()).toEqual({
      phone: "01012345678",
      rememberPin: false,
    });
  });

  it("prefills masked phone and PIN for the login form", () => {
    rememberWorkerLoginOnDevice("01012345678", "98765", true);
    expect(workerLoginPrefill()).toEqual({
      phone: "010-1234-5678",
      pin: "98765",
      rememberPin: true,
    });
  });

  it("defaults to remembering PIN when nothing is stored", () => {
    expect(workerLoginPrefill()).toEqual({ phone: "", pin: "", rememberPin: true });
  });

  it("ignores invalid stored payloads", () => {
    localStorage.setItem(WORKER_LOGIN_MEMORY_KEY, JSON.stringify({ phone: "abc", pin: "1" }));
    expect(loadWorkerLoginMemory()).toBeNull();
    clearWorkerLoginMemory();
    expect(localStorage.getItem(WORKER_LOGIN_MEMORY_KEY)).toBeNull();
  });
});
