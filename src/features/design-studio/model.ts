/**
 * Converts hierarchical design data into the flat document stream used by the studio.
 * The original hierarchy is retained through parentKey/depth while rendering stays linear.
 */

import type {
  DesignTreeResponse,
  RequirementDetail,
  StudioBlock,
} from "./types";

export function buildStudioBlocks(
  projectId: string,
  tree: DesignTreeResponse | undefined,
  requirement: RequirementDetail | undefined,
): StudioBlock[] {
  const unitWork = tree?.unitWorks[0];
  if (!unitWork) return [];

  const blocks: StudioBlock[] = [];

  if (requirement) {
    blocks.push({
      key: `requirement:${requirement.requirementId}`,
      entityId: requirement.requirementId,
      kind: "requirement",
      displayId: requirement.displayId,
      name: requirement.name,
      description: requirement.currentContent,
      parentKey: null,
      depth: 0,
      sourceHref: `/projects/${projectId}/requirements/${requirement.requirementId}`,
      format: "html",
    });
    blocks.push({
      key: `analysis:${requirement.requirementId}`,
      entityId: requirement.requirementId,
      kind: "analysis",
      displayId: requirement.displayId,
      name: "상세분석",
      description: requirement.analysisMemo,
      secondaryDescription: requirement.detailSpec,
      parentKey: `requirement:${requirement.requirementId}`,
      depth: 0,
      sourceHref: `/projects/${projectId}/requirements/${requirement.requirementId}`,
      format: "markdown",
    });
  }

  const unitWorkKey = `unitWork:${unitWork.unitWorkId}`;
  blocks.push({
    key: unitWorkKey,
    entityId: unitWork.unitWorkId,
    kind: "unitWork",
    displayId: unitWork.displayId,
    name: unitWork.name,
    description: unitWork.description,
    parentKey: requirement ? `requirement:${requirement.requirementId}` : null,
    depth: 0,
    sourceHref: `/projects/${projectId}/unit-works/${unitWork.unitWorkId}`,
    format: "markdown",
  });

  for (const screen of unitWork.screens) {
    const screenKey = `screen:${screen.screenId}`;
    blocks.push({
      key: screenKey,
      entityId: screen.screenId,
      kind: "screen",
      displayId: screen.displayId,
      name: screen.name,
      description: screen.description,
      parentKey: unitWorkKey,
      depth: 1,
      sourceHref: `/projects/${projectId}/screens/${screen.screenId}`,
      format: "markdown",
    });

    for (const area of screen.areas) {
      const areaKey = `area:${area.areaId}`;
      blocks.push({
        key: areaKey,
        entityId: area.areaId,
        kind: "area",
        displayId: area.displayId,
        name: area.name,
        description: area.description,
        parentKey: screenKey,
        depth: 2,
        sourceHref: `/projects/${projectId}/areas/${area.areaId}`,
        format: "markdown",
      });

      for (const fn of area.functions) {
        blocks.push({
          key: `function:${fn.functionId}`,
          entityId: fn.functionId,
          kind: "function",
          displayId: fn.displayId,
          name: fn.name,
          description: fn.description,
          parentKey: areaKey,
          depth: 3,
          sourceHref: `/projects/${projectId}/functions/${fn.functionId}`,
          format: "markdown",
          colMappingCount: fn.colMappingCount,
        });
      }
    }
  }

  return blocks;
}
