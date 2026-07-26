export const leadershipDimensions = [
  "CHARACTER",
  "PRESENCE",
  "INTELLECT",
  "LEADS",
  "DEVELOPS",
  "ACHIEVES",
] as const;

export type LeadershipDimension = (typeof leadershipDimensions)[number];

export type ArtifactType =
  | "CERTIFICATE"
  | "SCORE_SHEET"
  | "PHOTO"
  | "DOCUMENT"
  | "OTHER";

export type ArtifactCaptionStatus = "PENDING" | "COMPLETE" | "FAILED";

export type EntryConfirmationStatus =
  | "UNREVIEWED"
  | "CONFIRMED"
  | "NEEDS_CLARIFICATION"
  | "NOT_USED";

export interface EvidenceArtifact {
  id: string;
  name: string;
  type: ArtifactType;
  mimeType: string;
  size: number;
  previewUrl?: string;
  fileUrl?: string;
  aiCaption?: string;
  aiCaptionStatus: ArtifactCaptionStatus;
  flaggedByServiceMember: boolean;
  flagNote?: string;
}

export interface PerformanceEntry {
  id: string;
  supportFormId: string;
  entryDate: string;
  section: LeadershipDimension;
  entryType: "ACCOMPLISHMENT";
  rawText: string;
  goalId?: string;
  confirmationStatus: EntryConfirmationStatus;
  clarificationNote?: string;
  artifacts: EvidenceArtifact[];
  createdAt: string;
  submittedBy: string;
}

export interface CaptureDraft {
  rawText: string;
  section: LeadershipDimension;
  goalId?: string;
  eventDate: string;
  artifact?: File;
  artifactType?: ArtifactType;
  flaggedByServiceMember: boolean;
  flagNote?: string;
  attested: boolean;
}

export type ObservationFeedbackType = "POSITIVE" | "DEVELOPMENTAL" | "NEUTRAL";

export interface RaterAssignment {
  supportFormId: string;
  soldierId: string;
  displayName: string;
  rank: string;
  goals: Array<{ id: string; title: string }>;
}

export interface ObservationDraft {
  supportFormId: string;
  factualNote: string;
  sectionKey: LeadershipDimension;
  feedbackType: ObservationFeedbackType;
  occurredAt: string;
  goalId?: string;
}

export interface MobileBootstrap {
  user: {
    id: string;
    displayName: string;
    rank: string;
  };
  supportForm: {
    id: string;
    label: string;
    ratingPeriod: string;
  };
  goals: Array<{ id: string; title: string }>;
  entries: PerformanceEntry[];
  raterAssignments: RaterAssignment[];
}
