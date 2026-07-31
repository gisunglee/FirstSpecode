"use client";

/**
 * 프로젝트 source baseline 현황과 최초 승인 UI.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { authFetch } from "@/lib/authFetch";

type SourceBaseline = {
  baselineId: string;
  repoKey: string;
  repoProvider: string;
  branchName: string;
  checkpointType: string;
  checkpoint: string;
  checkpointVersion: number;
  historyAudit: string;
  lastReceiptId: string | null;
  reconciledAt: string | null;
};

type SourceRepository = {
  repositoryId: string;
  repoKey: string;
  provider: "GITHUB" | "GITLAB";
  repositoryPath: string;
  defaultBranch: string;
  maskedToken: string | null;
  webhookActive?: boolean;
};

export function SourceBaselinePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [repoKey, setRepoKey] = useState("");
  const [repoProvider, setRepoProvider] =
    useState<"LOCAL" | "NONE" | "GITHUB" | "GITLAB">("LOCAL");
  const [branchName, setBranchName] = useState("main");
  const [checkpointType, setCheckpointType] =
    useState<"GIT_COMMIT" | "SOURCE_MANIFEST">("GIT_COMMIT");
  const [checkpoint, setCheckpoint] = useState("");
  const [reason, setReason] = useState("");
  const [provider, setProvider] = useState<"GITHUB" | "GITLAB">("GITHUB");
  const [providerRepoKey, setProviderRepoKey] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [providerToken, setProviderToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [prunePreview, setPrunePreview] = useState<{
    receiptCount: number;
    contentFieldCount: number;
    retentionDays: number;
    previewToken: string;
  } | null>(null);
  const [showPruneConfirm, setShowPruneConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["source-baselines", projectId],
    queryFn: () =>
      authFetch<{ data: { items: SourceBaseline[] } }>(
        `/api/projects/${projectId}/source-baselines`,
      ).then((response) => response.data),
  });
  const { data: repositoryData } = useQuery({
    queryKey: ["source-repositories", projectId],
    queryFn: () =>
      authFetch<{
        data: { items: SourceRepository[]; canConnect: boolean };
      }>(`/api/projects/${projectId}/source-repositories`).then(
        (response) => response.data,
      ),
  });
  const createBaseline = useMutation({
    mutationFn: () =>
      authFetch<{ data: { baselineId: string } }>(
        `/api/projects/${projectId}/source-baselines`,
        {
          method: "POST",
          body: JSON.stringify({
            repoKey,
            repoProvider:
              checkpointType === "SOURCE_MANIFEST" ? "NONE" : repoProvider,
            branchName,
            checkpointType,
            checkpoint,
            historyAudit: "NOT_AUDITED",
            approvalReason: reason,
          }),
        },
      ),
    onSuccess: () => {
      toast.success("최초 source baseline을 승인했습니다.");
      setShowForm(false);
      queryClient.invalidateQueries({
        queryKey: ["source-baselines", projectId],
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const connectProvider = useMutation({
    mutationFn: () =>
      authFetch<{ data: SourceRepository }>(
        `/api/projects/${projectId}/source-repositories`,
        {
          method: "POST",
          body: JSON.stringify({
            repoKey: providerRepoKey,
            provider,
            repositoryPath,
            token: providerToken.trim() || undefined,
            webhookSecret: webhookSecret.trim() || undefined,
          }),
        },
      ).then((response) => response.data),
    onSuccess: (connected) => {
      toast.success(`${connected.provider} 저장소 연결을 확인했습니다.`);
      setRepoKey(connected.repoKey);
      setRepoProvider(connected.provider);
      setBranchName(connected.defaultBranch);
      setCheckpointType("GIT_COMMIT");
      setShowProviderForm(false);
      setShowForm(true);
      setProviderToken("");
      setWebhookSecret("");
      queryClient.invalidateQueries({
        queryKey: ["source-repositories", projectId],
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const pruneEvidence = useMutation({
    mutationFn: ({
      apply,
      previewToken,
    }: {
      apply: boolean;
      previewToken?: string;
    }) =>
      authFetch<{
        data: {
          applied: boolean;
          receiptCount: number;
          contentFieldCount: number;
          retentionDays: number;
          previewToken?: string;
        };
      }>(
        `/api/projects/${projectId}/spec-reconciliations/prune-evidence`,
        {
          method: "POST",
          body: JSON.stringify({ apply, previewToken }),
        },
      ).then((response) => response.data),
    onSuccess: (result) => {
      if (result.applied) {
        toast.success(`${result.receiptCount}건의 만료 evidence를 정리했습니다.`);
        setPrunePreview(null);
        setShowPruneConfirm(false);
      } else {
        setPrunePreview(
          result.previewToken
            ? { ...result, previewToken: result.previewToken }
            : null,
        );
        setShowPruneConfirm(false);
        if (result.receiptCount === 0) {
          toast.success("보관기간이 지난 source content가 없습니다.");
        }
      }
    },
    onError: (
      error: Error,
      variables: { apply: boolean; previewToken?: string },
    ) => {
      if (variables.apply) {
        setShowPruneConfirm(false);
        setPrunePreview(null);
      }
      toast.error(error.message);
    },
  });

  const items = data?.items ?? [];
  const repositories = repositoryData?.items ?? [];
  return (
    <section className="sp-group">
      <div className="sp-group-header">
        <h2 className="sp-group-title">Source baseline</h2>
        <div className="sp-reconcile-badge-row">
          {repositoryData?.canConnect ? (
            <button
              type="button"
              className="sp-btn sp-btn-secondary sp-btn-sm"
              onClick={() => setShowProviderForm((value) => !value)}
            >
              {showProviderForm ? "연결 입력 닫기" : "Git provider 연결"}
            </button>
          ) : null}
          <button
            type="button"
            className="sp-btn sp-btn-secondary sp-btn-sm"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "입력 닫기" : "최초 기준선 승인"}
          </button>
        </div>
      </div>
      <div className="sp-group-body">
        {repositories.length > 0 ? (
          <div className="sp-hint is-info">
            연결됨 ·{" "}
            {repositories
              .map(
                (repository) =>
                  `${repository.provider} ${repository.repositoryPath}`,
              )
              .join(", ")}
          </div>
        ) : null}

        {showProviderForm ? (
          <div className="sp-reconcile-baseline-form">
            <div className="sp-reconcile-evidence-title">
              Git provider 연결
            </div>
            <div className="sp-reconcile-decision-grid">
              <div className="sp-field">
                <label className="sp-label" htmlFor="provider-type">
                  Provider
                </label>
                <select
                  id="provider-type"
                  className="sp-input"
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as "GITHUB" | "GITLAB")
                  }
                >
                  <option value="GITHUB">GitHub</option>
                  <option value="GITLAB">GitLab.com</option>
                </select>
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor="provider-repo-key">
                  Repo key
                </label>
                <input
                  id="provider-repo-key"
                  className="sp-input"
                  value={providerRepoKey}
                  onChange={(event) => setProviderRepoKey(event.target.value)}
                  placeholder="서비스에서 사용할 고정 식별자"
                />
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor="provider-repo-path">
                  Repository path
                </label>
                <input
                  id="provider-repo-path"
                  className="sp-input"
                  value={repositoryPath}
                  onChange={(event) => setRepositoryPath(event.target.value)}
                  placeholder="owner/repository"
                />
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor="provider-token">
                  Access token (공개 저장소는 선택)
                </label>
                <input
                  id="provider-token"
                  className="sp-input"
                  type="password"
                  autoComplete="new-password"
                  value={providerToken}
                  onChange={(event) => setProviderToken(event.target.value)}
                />
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor="provider-webhook-secret">
                  Webhook secret (선택)
                </label>
                <input
                  id="provider-webhook-secret"
                  className="sp-input"
                  type="password"
                  autoComplete="new-password"
                  value={webhookSecret}
                  onChange={(event) => setWebhookSecret(event.target.value)}
                  placeholder="16자 이상"
                />
              </div>
            </div>
            <div className="sp-hint is-warn">
              token은 Git source 검증 전용으로 암호화 저장하며 AI provider key와
              섞지 않습니다. 저장 전 실제 repository 조회로 연결을 확인합니다.
            </div>
            {webhookSecret.trim() ? (
              <div className="sp-hint is-info">
                Webhook URL ·{" "}
                <code className="sp-code">
                  /api/integrations/source-repositories/
                  {provider.toLowerCase()}/webhook
                </code>
                <br />
                GitHub는 Pull requests, GitLab은 Merge request events를 선택하세요.
              </div>
            ) : null}
            <button
              type="button"
              className="sp-btn sp-btn-primary"
              disabled={
                connectProvider.isPending ||
                !providerRepoKey.trim() ||
                !repositoryPath.trim()
              }
              onClick={() => connectProvider.mutate()}
            >
              연결 확인 및 저장
            </button>
          </div>
        ) : null}

        {repositoryData?.canConnect ? (
          <div className="sp-reconcile-decision">
            <div className="sp-reconcile-evidence-title">
              Source evidence 보관
            </div>
            <p className="sp-reconcile-evidence-copy">
              프로젝트 환경설정의 보관기간이 지난 CLOSED receipt에서 patch/content만
              정리합니다. 경로·hash·checkpoint·판단 이력은 유지합니다.
            </p>
            {prunePreview && prunePreview.receiptCount > 0 ? (
              <div className="sp-hint is-warn">
                {prunePreview.retentionDays}일 기준 · receipt{" "}
                {prunePreview.receiptCount}건 · content 필드{" "}
                {prunePreview.contentFieldCount}개가 정리됩니다.
              </div>
            ) : null}
            <div className="sp-reconcile-badge-row">
              <button
                type="button"
                className="sp-btn sp-btn-secondary sp-btn-sm"
                disabled={pruneEvidence.isPending}
                onClick={() => {
                  setShowPruneConfirm(false);
                  setPrunePreview(null);
                  pruneEvidence.mutate({ apply: false });
                }}
              >
                정리 대상 미리보기
              </button>
              {prunePreview && prunePreview.receiptCount > 0 ? (
                <button
                  type="button"
                  className="sp-btn sp-btn-danger sp-btn-sm"
                  disabled={pruneEvidence.isPending}
                  onClick={() => setShowPruneConfirm(true)}
                >
                  만료 content 정리
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <span className="sp-spinner" />
        ) : items.length === 0 ? (
          <div className="sp-hint is-warn">
            기준선이 없습니다. `/sync-specode`가 알려주는 repoKey·branch와 현재 commit 또는
            manifest hash를 검토한 뒤 최초 기준선으로 승인하세요.
          </div>
        ) : (
          <div className="sp-reconcile-baseline-list">
            {items.map((baseline) => (
              <div
                key={baseline.baselineId}
                className="sp-reconcile-baseline-row"
              >
                <div>
                  <div className="sp-reconcile-table-title">
                    {baseline.repoKey} · {baseline.branchName}
                  </div>
                  <div className="sp-reconcile-path">
                    {baseline.checkpointType} · {shortHash(baseline.checkpoint)}
                  </div>
                </div>
                <div className="sp-reconcile-badge-row">
                  <span className="sp-badge sp-badge-info">
                    v{baseline.checkpointVersion}
                  </span>
                  <span className="sp-badge sp-badge-neutral">
                    {baseline.historyAudit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm ? (
          <div className="sp-reconcile-baseline-form">
            <div className="sp-reconcile-decision-grid">
              <div className="sp-field">
                <label className="sp-label" htmlFor="baseline-repo-key">
                  Repo key
                </label>
                <input
                  id="baseline-repo-key"
                  className="sp-input"
                  value={repoKey}
                  onChange={(event) => setRepoKey(event.target.value)}
                  placeholder="local-..."
                />
              </div>
              {checkpointType === "GIT_COMMIT" ? (
                <div className="sp-field">
                  <label className="sp-label" htmlFor="baseline-provider">
                    Evidence provider
                  </label>
                  <select
                    id="baseline-provider"
                    className="sp-input"
                    value={repoProvider}
                    onChange={(event) =>
                      setRepoProvider(
                        event.target.value as
                          | "LOCAL"
                          | "GITHUB"
                          | "GITLAB",
                      )
                    }
                  >
                    <option value="LOCAL">Local agent</option>
                    {repositories.map((repository) => (
                      <option
                        key={repository.repositoryId}
                        value={repository.provider}
                      >
                        {repository.provider} · {repository.repoKey}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="sp-field">
                <label className="sp-label" htmlFor="baseline-branch">
                  Branch
                </label>
                <input
                  id="baseline-branch"
                  className="sp-input"
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor="baseline-type">
                  Checkpoint type
                </label>
                <select
                  id="baseline-type"
                  className="sp-input"
                  value={checkpointType}
                  onChange={(event) =>
                    setCheckpointType(
                      event.target.value as "GIT_COMMIT" | "SOURCE_MANIFEST",
                    )
                  }
                >
                  <option value="GIT_COMMIT">Git commit</option>
                  <option value="SOURCE_MANIFEST">Source manifest</option>
                </select>
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor="baseline-checkpoint">
                  Checkpoint
                </label>
                <input
                  id="baseline-checkpoint"
                  className="sp-input"
                  value={checkpoint}
                  onChange={(event) => setCheckpoint(event.target.value)}
                />
              </div>
            </div>
            <div className="sp-field">
              <label className="sp-label" htmlFor="baseline-reason">
                승인 사유
              </label>
              <textarea
                id="baseline-reason"
                className="sp-input sp-textarea"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="이 시점 이전은 NOT_AUDITED이며, 이후 변경부터 추적합니다."
              />
            </div>
            <button
              type="button"
              className="sp-btn sp-btn-primary"
              disabled={
                createBaseline.isPending ||
                !repoKey.trim() ||
                !branchName.trim() ||
                !checkpoint.trim() ||
                !reason.trim()
              }
              onClick={() => createBaseline.mutate()}
            >
              최초 기준선 승인
            </button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={showPruneConfirm}
        title="만료 source content 영구 정리"
        description={
          prunePreview
            ? `receipt ${prunePreview.receiptCount}건의 원본 source content ${prunePreview.contentFieldCount}개가 영구 삭제됩니다. 경로·hash·checkpoint·판단 이력은 유지되지만 삭제된 원본은 복구할 수 없습니다.`
            : "보관기간이 지난 원본 source content가 영구 삭제되며 복구할 수 없습니다."
        }
        confirmLabel="영구 정리"
        loading={pruneEvidence.isPending}
        onConfirm={() => {
          if (prunePreview) {
            pruneEvidence.mutate({
              apply: true,
              previewToken: prunePreview.previewToken,
            });
          }
        }}
        onCancel={() => {
          if (!pruneEvidence.isPending) setShowPruneConfirm(false);
        }}
      />
    </section>
  );
}

function shortHash(value: string) {
  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}
