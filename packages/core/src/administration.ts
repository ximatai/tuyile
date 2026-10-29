import {
  executionSettingsInput,
  planningPolicyInput,
  type ExecutionSettings,
  type PlanningPolicy,
  type Principal,
  type AdminSummary,
} from "@tuyile/contracts";
export interface AdministrationRepository {
  settings(p: Principal): Promise<ExecutionSettings>;
  saveSettings(p: Principal, input: ExecutionSettings): Promise<void>;
  policy(p: Principal, userId: string): Promise<PlanningPolicy>;
  savePolicy(
    p: Principal,
    userId: string,
    input: PlanningPolicy,
  ): Promise<void>;
  summary(p: Principal): Promise<AdminSummary>;
}
export interface AdministrationStore {
  read<T>(run: (r: AdministrationRepository) => Promise<T>): Promise<T>;
  write<T>(
    owners: string[],
    run: (r: AdministrationRepository) => Promise<T>,
  ): Promise<T>;
}
export class AdministrationService {
  constructor(private readonly store: AdministrationStore) {}
  settings(p: Principal) {
    return this.store.read((r) => r.settings(p));
  }
  saveSettings(p: Principal, input: ExecutionSettings) {
    const parsed = executionSettingsInput.parse(input);
    return this.store.write([p.id], (r) => r.saveSettings(p, parsed));
  }
  policy(p: Principal, userId: string) {
    return this.store.read((r) => r.policy(p, userId));
  }
  savePolicy(p: Principal, userId: string, input: PlanningPolicy) {
    const parsed = planningPolicyInput.parse(input);
    return this.store.write([p.id, userId], (r) =>
      r.savePolicy(p, userId, parsed),
    );
  }
  summary(p: Principal) {
    return this.store.read((r) => r.summary(p));
  }
}
