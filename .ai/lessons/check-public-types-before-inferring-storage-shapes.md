---
title: "Check public types before inferring storage shapes"
modules: ["agent_orchestrator","workflows"]
areas: ["debugging","architecture"]
topics: ["type-normalization","workflow","testing"]
---

# Check public types before inferring storage shapes

**Context**: A review-task call failed TypeScript checking because its scope contained nullable identifiers.

**Problem**: Advice inferred that `review.assignedTo` needed an array from the stored UserTask shape. The public disposition descriptor actually accepts a string and normalizes it internally, so the suggestion introduced another type error.

**Rule**: Read the exact exported input type before recommending a payload change. Follow the first incompatible field named by the compiler and distinguish authoring descriptors from normalized persisted records. Do not infer the calling contract from a downstream entity.

**Applies to**: Workflow review descriptors, command inputs, and other boundaries that normalize data before persistence.
