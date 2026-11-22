# tap-public-1.0 — Thought As Private, Public Source License

**Version**: 1.0 (English reference translation)
**Authoritative text**: The Chinese text (中文定本) is the sole authoritative version per §16.2. This English translation is a clause-by-clause reference; in any semantic conflict the Chinese text governs. The three semantic anchors (§1.2a code/thought boundary, §9.3b systematicity test, §5.5 function point definition) are preserved without simplification.

Copyright (c) [Year] [Copyright Holder]. All rights reserved under the terms below.

---

## Preamble

A software work has two layers: its **code** (the implementation) and its **thought** (the reasoning behind it — design concepts, architectural decisions, creative rationale). Code should be public, as all good infrastructure is; **thought remains the creator's** — publishing code transfers the implementation, not the soul. A recipient receives a license to the code, not a right to harvest the design reasoning.

---

## 1. Definitions

1.1 **The Work**: the software declared to be under this license, including source code, object code, build scripts, documentation, and accompanying materials.

1.2 **Thought Materials**: carriers of the creator's reasoning, including but not limited to:
- Design documents and architecture decision records (ADR, RFC, design rationale);
- Development notes, roadmaps, records of the creative process;
- Design decision grounds in comments and issue discussions;
- Internal design materials not distributed with the code (even if existing only in the creator's private environment);
- **All forms of the design process, finalized or not**: interrogative notes ("why X? maybe because Y"), alternative comparisons, rejection rationale, unfinalized hypotheses — **the creative process does not lose protection for being unfinalized** (an unfinalized thought is still a thought).

1.2a **Objective anchors for the code/thought boundary** (binding for §9.2a and the whole license):
- **Interface signatures, function declarations, data structure definitions, expression of algorithmic logic** = code layer (freely copyable);
- **Design decisions and their grounds, architectural rationale, alternative comparisons, rejection processes, questions and hypotheses** = thought layer (protected by §9);
- **Paired carrying of a signature together with its design rationale** (take the signature, and also take the comment saying "why it was designed this way") = carrying the signature is lawful; carrying the rationale violates §9.2a — **you may take the What, not the Why**;
- Disputed cases are decided by the **deletion test**: if the content is removed from the Work and the remaining parts' function and structure are unchanged, the content is thought layer; if removal causes missing function or structural change, it is code layer;
- Pseudocode: expressing **the concrete steps of an implemented algorithm** (one-to-one mappable to the Work's code) = code layer; expressing **design methodology or decision logic** (not mappable to a concrete implementation) = thought layer.

1.3 **Agent Mechanism**: the runtime architecture implemented in code within the Work — including but not limited to mode systems, self-improvement loops, context management, archive systems.

1.4 **Third-Party System**: any software that is not a derivative work of the Work, including other IDEs, agent harnesses, model training pipelines, data collection systems.

1.5 **Commercial Use**: any activity primarily intended for commercial advantage or monetary compensation, including but not limited to: selling, renting out, or licensing the Work or derivatives; hosting the Work as a paid service or incorporating it into revenue-generating products; production-environment use within a for-profit organization. **Personal use, academic research, and non-profit use do not constitute Commercial Use.**

1.5a **Evaluation Window**: internal evaluation and testing within a for-profit organization is limited to **180 days** (counted from deployment of the first copy within the organization — deployment = a copy entering the organization's controlled environment, **regardless of whether it is actually run or used by anyone**, preventing "downloaded but unused" clock-dragging). Continued use beyond the window without a commercial license constitutes Commercial Use. Use during the window must not carry real production traffic (routine operation carrying real business data is not "evaluation" — evaluation = test environment + simulated data).

1.6 **Derivative Work** — a two-axis test; both must be satisfied:

  a) **Substantial-source axis**: the work contains a substantial portion of the Work (source code, object code, or a substantially equivalent implementation of the Agent Mechanism interfaces), or is a modification, translation, port, or refactoring of the Work. **For the purposes of this license, "substantial" and "substantially equivalent" carry the quantitative meaning defined in §5.5 (source share ≥ 10% by any measure) and the terminology-unification rule of §5.5 — NOT the common-law "substantiality" test; "substantially equivalent" is decided by structural similarity under the §5.5 code measure.** The following do **not** constitute derivative works: i) independent software interoperating with the Work solely through interfaces documented publicly — **except "Extension Works" (see 1.7)**; ii) independent implementations without substantial code or interface lineage with the Work ("independent rewrite after understanding the idea" is not a derivative — the idea layer follows the openness of §9A.1); iii) works containing only independently licensed components accompanying the Work (governed by their original licenses); iv) aggregate distribution (the Work and an independent work distributed on the same medium without modifying each other, with clear interface boundaries — each keeps its license, except Extension Works loaded by the Work).

  b) **Distribution axis**: the work is distributed or provided as a service to a third party. **Objective definition of "third party"**: measured in **legal entities** — transfer within a single legal entity (including a parent to a wholly-owned subsidiary) is not distribution to a third party; transfers between controlled, contractually controlled, or affiliated (non-wholly-owned) companies **do constitute** distribution; an employee's use in the course of employment counts as use by their legal entity — the employee is not a third party.

  Failing either axis means not a derivative work: local private modification without distribution (fails b) → private-use exemption (§6.3); pure interface interoperability (fails a) → independent software.

  **Boundary clarification**: whether behavioral cloning (replicating the Work's mechanism ideas without copying expression) is a derivative is decided under a) by substantial equivalence: **interface signatures substantially identical pair-for-pair, OR structural equivalence** (substantially isomorphic division of class/module responsibilities, relationship topology, and inheritance structure, without independent design rationale — cross-language transcription falls here: same structure in a different language = a "translation" under 1.6-a) = derivative; merely similar functional semantics with independent expression (structure with its own design rationale that survives independent interrogation of "why designed this way") = not a derivative.

1.7 **Extension Works** — a distinct category under this license:

  **Definition**: any work — plugin, extension, theme, language, template, configuration package or otherwise — developed against the Work's extension interfaces (Extension API) and declared dedicated to the Work. Whether or not it copies the Work's code, **it is an Extension Work, not ordinary independent software** — the fact of depending on the host to run itself constitutes "substantial source linkage".

  **Obligations** (heavier than ordinary independent software):
  - e1) Attribute the Work per §5 (the host contributed the runtime environment);
  - e2) Comply with §9 Thought Materials — Thought Materials accessible via the extension interfaces receive equal protection (an extension must not become a bypass exit for Thought Materials);
  - e3) Must not have as a functional purpose the removal, circumvention, or weakening of the Work's license notices, attribution, or Thought Materials protection (anti "crack extension");
  - e4) Its own license is the extension author's choice, but must not conflict with e1–e3.

  **Rights** (lighter than derivative works):
  - r1) Not subject to file-level copyleft (§4.1) — extension code may be released under any license (it is your original increment, the proper object of the 9A.3 private domain);
  - r2) Not subject to the anti-porting clause (§6.1) — extensions run inside the Work by definition;
  - r3) **Idea feedback on equal terms with derivatives**: Extension Works are equally subject to §9A.1/§9A.3 — **the ideas in an extension may be drawn upon by the original author, who when doing so is bound by the §9A.4 manner-of-absorption rules** (source acknowledgment + positive absorption + absorption restraint: the host names you in its changelog when absorbing your idea). Extension code is protected by §9A.2 (the original author may draw on its ideas but not copy its code), identical in standing to derivative works. **Three things the extension author receives**: full property in their code; visible attribution when absorbed (the work's résumé appreciates with each mainline release); a negotiating position via the §8.4 commercial channel.

  **Classification**: whether a work is "declared dedicated to the Work" is decided by the **objective dependency test** — if ≥ 80% of a work's external interface invocations target the Work's extension interfaces, it falls in the Extension Work class regardless of how many hosts it claims to support; if < 80% and it publicly declares and actually runs on other hosts, it is treated as ordinary independent software, except that the parts interacting with the Work remain subject to e2/e3. **A declaration does not override the measurement**: nominally multi-host but interface-dependent mostly on the Work → the measurement prevails.

  **Design logic**: tap supports a plugin ecosystem, but the ecosystem must not become a thought-protection bypass — **the host's capabilities may open, the host's constitution must follow**. Extension authors enjoy relief (no copyleft) at the price of accepting e2/e3 (protection follows the interface).

## 2. Reservation and Active Defense

2.1 **General reservation** (fallback): all rights not expressly granted are reserved to the copyright holder. This clause is a fallback and does not replace the itemized claims of 2.2 — **for any right listed in 2.2, the specific terms of 2.2 govern**.

2.2 **Itemized reservation list** (active defense matrix — the boundary and guard clause of each right):

  a) **Trademark**: the Work's name, logo, and marks are not licensed by anything in this license. Derivatives/Extensions must not use them (§5.3 is its extension).

  b) **Patents**: the grant of §11 covers only claims necessarily infringed by implementation; **defensive patents** (held by derivative authors, usable for counterclaims) are not impliedly licensed — separate negotiation under §8.4 is required.

  c) **All rights in Thought Materials** (§9 is their substantive law): reproduction, compilation, information-network dissemination, training use — all reserved. **Thought Materials distributed with the code are not impliedly licensed by distribution** (anti comment-smuggling: see §9.2a).

  d) **Right to modify the interface specification**: the Work's public interface specification (Extension API) may be implemented, not **rewritten and re-issued as a competing standard** — forking the spec and publishing a modified version = fabricating an incompatible ecosystem, violating §6.2.

  e) **Exclusive right to official distribution channels**: marketplaces, indexes, or directory services operated in the Work's name may be operated only by the copyright holder (§8.1 commercial licensing is its extension).

  f) **Right to certify compatibility claims**: declaring "officially compatible/certified with tap" requires written authorization (§5.3 anti-impersonation is its extension); third-party compatibility claims must be truthfully marked "unofficial".

  g) **Market order against predatory derivatives**: §9A.8 non-interference is the rule, but **predatory competition** (dumping below cost to attack the Work, based on the Work's own code) is handled under §8.1 commercial terms.

2.3 **Express prohibition list** (translating "unlisted reservation" into "listed prohibitions" — a recipient committing any of the following breaches this license without invoking the 2.1 presumption):

  a) **Comment smuggling**: transcribing Thought Materials into code comments, README narratives, or commit messages and then claiming they are freely copyable code layer (see §9.2a);

  b) **Perpetual evaluation**: running within a for-profit organization under an "evaluation and testing" label beyond 180 days (see §1.5a window);

  c) **Exemption stacking**: splitting the Work into multiple "each <10%" parts to evade attribution and derivative obligations (see §5.5 aggregation clause);

  d) **Service escape**: providing interactive functionality based on the Work over a network without distributing copies (see §6.4 network clause);

  e) **Aggregation training**: assembling "fair quotation" excerpts into training corpora, knowledge bases, or retrieval indexes (see §9.3a aggregation bar);

  f) **Fake multi-host**: nominally declaring multi-host support while actually running primarily on the Work, to escape Extension Work obligations (see §1.7 objective test);

  g) **Disguised repair**: smuggling new function points under a "security fix" label to force the §9A.3a non-excludable zone (see §9A.3a test);

  h) **Policy ambush**: adding extension rules ad hoc to strike at existing extensions (already banned by §9A.8; restated as an independent breach ground).

## 3. Non-Commercial Grant (Public Layer)

3.1 Subject to full compliance with this license, any person obtaining a copy of the Work enjoys, for non-commercial purposes: use, copying, inspection, study, modification, merging, publication, and distribution.

3.2 This license transfers no ownership. All rights not expressly granted remain with the copyright holder.

## 4. Copyleft (File-Level)

4.1 A modified source file, when redistributed, must continue to be published under this license, retaining original copyright, license, and disclaimer notices.

4.2 Unmodified files and new files may each choose their license; provided that the Work's **Agent Mechanism interface-layer files** (defined in §6.2) must remain under this license when distributed with the Work, whether modified or not. `[TO BE DECIDED: how the interface-layer file list is demarcated]`

## 5. Attribution and Anti-Impersonation

5.1 Distributing the Work or derivatives must retain original copyright notices and the full license text.

5.2 Derivative works' documentation and interfaces must contain prominent attribution of the Work (reasonable forms: splash-screen credit or documentation entry).

5.3 **No false endorsement**: implying in any way that the original author or the Work endorses, sponsors, or is affiliated with a derivative is prohibited.

5.4 **No impersonation of authorship or dilution of origin** — all of the following are prohibited:

  a) Presenting the Work or a substantial portion of it as entirely one's own creation;

  b) **Dilution**: presenting the Work's contribution in any **demoted** form — including describing a substantial portion as "partially referenced", "inspired by some projects", "uses open-source components" or similar vague wording, such that a reasonable third party cannot identify the Work and its author from the statement;

  c) **Visibility downgrade**: attribution present but placed where or in a form a reasonable user cannot notice in normal acquisition and use (e.g., only deep in source code, a millisecond flash on exit, font shrunk to unreadability);

  d) **Contribution inversion**: any statement or implication causing a reasonable third party to believe the derivative's main value comes from the derivative author while the Work is a minor or auxiliary component. **"Main value" and "core mechanism" are decided by the §5.5 quantitative standard**, which governs over wording.

  **Decision benchmark**: this clause asks whether "**a reasonable third party, in the normal course of acquiring and using the derivative, can reasonably recognize the substantial contribution of the Work and its author**" — wording that literally acknowledges contribution is not the test; cognitive effect is. Quantification in §5.5.

5.5 **Quantitative standard** (decision basis for 5.4-d and related formulations):

  **First quantity: source share** (three measures; any one suffices):
  - **Code measure**: the proportion of the derivative's total lines of code originating from the Work (by substantial-equivalence comparison, excluding generated artifacts and comments);
  - **Runtime measure**: the proportion of instruction-execution time, on the execution paths of the derivative's normal operation, spent in the Work's code (sampled; median under typical workloads);
  - **Function measure**: the proportion of the derivative's user-visible function points that depend on the Work's code to be implementable. **Function point = the smallest complete unit of capability a user can perceive and name** — granularity is decided by the test question "**can the user have only it and not the rest**", of which "can the user separately request / separately refuse / separately pay for it" are three equivalent probes (any ONE suffices) (a user can have "export PDF" without "print", so they are two function points; a user cannot have "lock mechanism" without "transaction", so "lock mechanism" is an implementation detail, not a function point). **Splitting bar (applies both ways)**: a) decomposing a single user-nameable capability into technical sub-steps to dilute share — the sub-steps are **counted as one function point**; b) packaging interaction steps as "independent functions" to inflate the denominator or the repair test ("choose format" + "generate file" + "download" = one "export" function point) — equally merged — **the unified test question is "can the user have only it and not the rest"**: yes = function point; no = detail.

  **Thresholds**:
  - Source share **≥ 30%** (any measure): the Work is a **principal source** — attribution must reach "principal contributor" level (prominent placement, name, clickable source link; subordinate-clause burial prohibited); contribution inversion (5.4-d) fully applies;
  - Source share **10%–30%** (any measure): the Work is an **important source** — attribution must reach "important component" level (separate documentation entry + source link; splash-screen credit optional); contribution inversion does not apply; dilution (5.4-b/c) still applies;
  - Source share **< 10%** (all measures): the Work is a **minor source** — retaining the copyright notice and full license text (5.1) is sufficient attribution; 5.4-b/c no longer apply (but 5.4-a, the ban on wholesale impersonation, always applies).

  **"Core mechanism"** (for 5.4-d and §6.2): a functional module is a **core mechanism** of the Work if any of:
  - ① it is within the Agent Mechanism list of §1.3 (mode systems, self-improvement loops, context management, archive systems);
  - ② removing it makes the derivative's main user scenarios unusable (by §5.5 function points, covering ≥ 50% of function points);
  - ③ it accounts for ≥ 40% of execution time under the runtime measure.

  **Measurement disputes**: each side measures; the **union judgment** applies (whichever side's measurement falls in the stricter band governs) — where measurement cost exceeds the value in dispute, the 10%–30% band (important source) applies.

  **Aggregation clause** (anti-splitting): source share is computed on the **total Work content introduced into a single product by a single recipient** — splitting the Work into parts, or introducing it repeatedly or through intermediaries into the same product, is measured in aggregate. **Control relationships** (anti-shell, anti-contractual splitting): equity control, contractual control (outsourcing / operating-agency / commissioned development / long-term service contracts), or **common beneficial ownership** (piercing through to the ultimate natural person; trusts and nominee arrangements pierced) — any one suffices to aggregate — multiple entities "without equity ties" but actually coordinated by the same natural person are aggregated.

  **Terminology unification**: all uses of "substantial portion" / "substantial source" in this license mean a §5.5 source share ≥ 10% (any measure) — below that threshold, incorporation is not "substantial" and does not trigger derivative classification or 5.4-b/c; "substantial equivalence" is decided by the §5.5 code-measure comparison method (structural similarity, not literal identity — renaming, reformatting, and equivalent syntactic transformations do not break equivalence).

## 6. Anti-Porting Clause (tap-specific)

6.1 No part of the Work may be embedded, **when distributed**, as a plugin, extension, language server, or module in a third-party IDE or agent harness product.

6.2 The Agent Mechanism interfaces (mode scheduling, improvement loops, archive read/write) must not be invoked as a backend by third-party systems and distributed.

6.3 **Private-use exemption**: personal local modification, experimentation, and self-integration are not bound by 6.1/6.2 — this clause binds distribution, not use.

6.4 **Network service clause** (SaaS-escape closure): providing **interactive functionality** based on the Work or its derivatives over a network to the public is treated as distribution — the provider must satisfy all requirements this license imposes on that derivative (attribution, Thought Materials obligations, copyleft), or obtain a commercial license under §8. Trigger: ≥ 30% of the service's core function points (§5.5 function measure) implemented by the Work's code; **API-wrapped resale** (wrapping the Work as a network API for third-party invocation) equally constitutes network distribution. **Definition of "interactive functionality"**: any service that returns, on request, results computed by the Work's code — regardless of user interface, session state, or frontend — **headless APIs and UI-bearing services are equally covered**; "we only return data" is not an exemption (the data is the running product of the Work's code).

## 7. Relicensing Lock

7.1 On redistribution, one must **not remove, weaken, or add extra restrictions conflicting with this license**.

7.2 **No sublicensing**: a recipient may distribute only under the verbatim text of this license and may not re-grant rights in their own name.

## 8. Commercial Licensing (Dual Track)

8.1 Commercial use requires the copyright holder's **prior written permission** (contact: `[TO BE DECIDED: business email/channel]`).

8.2 A commercial license may exempt the §5.2 attribution duty (unless exemption is expressly given, attribution remains required).

8.3 **Non-waivable clauses**: even under a commercial license, §9 (Thought Materials) and §6 (anti-porting) remain fully in force — **thought protection does not discount for commercial licensing**.

8.4 **Special Grant**: the copyright holder may, in writing, grant **any subset of rights** to specific persons or entities — not limited to commercial licenses — including but not limited to:

  a) exemption of specific clauses (§5 attribution, the §6.1 embedding right, §4 copyleft for designated files) — **except §9 and the §9A.3a non-excludable zone, which are never waivable**;
  b) rights beyond the license (trademark use, patent cross-licenses, priority support, roadmap participation);
  c) attached conditions (term, scope, revocation, consideration) — freely negotiated between the parties; this license does not restrict their content, except that attached conditions must not weaken §9's protection of **end users**.

  Formal requirements: in writing (including electronic signature or verifiable commit/announcement), naming the grantee and the scope of rights, issued by the copyright holder. **Relation to §7.2**: 7.2 bars a recipient from re-granting in their own name; 8.4 is a **new license issued personally by the copyright holder** — the source is always the copyright holder; there is no intermediate grantor between the two levels.

  **Withdrawal**: a Special Grant may be withdrawn per its own revocation terms; absent such terms, the copyright holder may withdraw on 30 days' written notice, but **not retroactively** (compliant uses already occurred are unaffected).

## 9. Thought Materials Clause (Private Layer — the soul of tap)

9.1 **Ownership**: Thought Materials belong to the creator (copyright holder). Distribution of Thought Materials with the Work **constitutes no transfer of rights** — what a recipient receives is the code-layer grant (3.1), not a grant over Thought Materials.

9.2 **Grant boundary**: everything granted by this license (use, copy, modify, distribute, etc.) **covers the code layer only**. Even where Thought Materials are distributed with the repository, the recipient obtains only the factual status of "possession and reading" — copying, redistribution, and compilation of Thought Materials are outside the 3.1 grant.

9.2a **Comment attribution clause** (anti comment-smuggling): content in code comments, commit messages, or README narratives that **expresses design decisions and creative rationale** ("why it is done this way" content) is Thought Materials regardless of physical carrier — transcribing it from comment/document form into any other form (including back into "another project's comments") and redistributing violates 9.2. **The code/thought decision follows the nature of the content, not the file type**: an interface signature in a .md file is code layer (copyable); architectural rationale in a .java comment is thought layer (not carryable). Applied together with 9.3.

9.3 **Extraction and training ban**: systematic extraction, compilation, or indexing of the Work's Thought Materials is prohibited; using Thought Materials to train, fine-tune, or evaluate any machine learning model is prohibited. **The code may be learned; the thought may not be harvested** — reading the code to understand its implementation does not violate this clause (that is the very point of publishing code), but systematically carrying over design decisions, architectural rationale, or the creative process for use elsewhere violates it. **Reverse-engineering boundary**: understanding design by reading the code in one's head = lawful learning; but re-encoding the design decisions so derived **into any carrier** (documents, notes, diagrams, models) and distributing or aggregating it is deemed a transcription of Thought Materials (9.2a) or systematic extraction (9.3b) — **understanding in the mind is lawful; once re-encoded into a carrier, the constraints attach**.

9.3b **Objective test for "systematic"**: any one of the following constitutes systematicity — a) **count standard**: ≥ 3 acts of **extracting, quoting, or transcribing** Thought Materials by the same channel (**mere reading and holding do not count under this item** — that is the factual state of 9.2, not extraction; this item counts only acts that "turn thought into a carrier" ("channel" = a single natural person, or **a group of natural persons under common beneficial-owner control** — distributed acquisition [each person taking once] is aggregated by beneficial owner — **or any automated means attributable to a natural or legal person** [bots, crawlers, agents, pipelines]; each automated act counts individually and aggregates to its operator)); b) **quantity standard**: a single act carrying Thought Materials covering ≥ 30% of the design decisions of any module of the Work (carrying away one core decision in one act = systematic, regardless of count); c) **purpose standard**: the act's purpose is constructing an accumulation of any form (corpus, index, note system, training pipeline) — **taking in order to accumulate is systematic even once**; the defenses "temporary debugging" and "deleted after use" must be rebutted by the claiming party with **evidence of post-acquisition retention** (local archives, clipboard history, note-tool records); failing rebuttal, accumulation is presumed. Where the single-quote exemption (9.4) conflicts with a), 9.4's "fair quotation" presupposes **non-accumulation purpose**: quotations discarded after use (not archived into any base after the review is published or the paper submitted) do not count toward a).

9.3a **Aggregation bar** (anti-ant-moving): an **assemblage** (corpus, knowledge base, retrieval index, note collection — human or machine assembled) of contents obtained through repeated exercise of the 9.4 fair-quotation exemption, exceeding the reasonable scope of single quotations, violates 9.3. Test: where Thought Materials originating from the Work account for ≥ 5% of the assemblage by the §5.5 code-measure method, violation is presumed (single fair quotations cannot accumulate to this share). **Reconstruction-merge of split objects**: where the quoted content was pre-split (into issues, commits, cards) and then quoted piecewise, measurement is on the pre-split original content — splitting does not change the integrity determination of the quoted object.

9.4 **Fair quotation exemption**: reasonable quotation of Thought Materials for commentary, academic research, security research, or news reporting (with attribution, scope proportionate to purpose) does not violate 9.2/9.3.

9.5 **Obligations follow distribution**: a derivative of the Work that is distributed containing Thought Materials originating from the Work is subject to the same protective obligations, without weakening; commercial licenses do not exempt this clause.

## 9A. Original Author and Derivatives (tap-specific — bidirectional asymmetry)

9A.1 **Idea Feedback** (tap-internal term): the author of a derivative work permits the original author to use the ideas, concepts, methods, and design reasoning embodied in the derivative, without further authorization — the idea layer is open to the original author. **This clause is no expropriation of derivative authors**: it is the nutrient cycle between the community and the main work — one person's ideas are ultimately fewer than the community's; a main work that refuses to absorb becomes a puppet living off its extensions. tap therefore makes this cycle the ecosystem's foundation rather than any single author's privilege. Derivative authors receive in exchange: full property in their code (9A.2), first-mover advantage (the market time-differential before absorption into the mainline, protected by the 9A.4-c2 lag window), and a negotiating position via the 8.4 commercial channel for competitively strong works.

9A.2 **Code and expression closure**: the original author **must not** copy from a derivative: a) source code and object code (**including pseudocode** — pseudocode one-to-one mappable to the derivative's concrete implementation is an expressive transcription of its source and equally protected; general pseudocode expressing design methodology is open under 9A.1); b) patent technology (including technical solutions in patent applications); c) the parts the derivative author has excluded via a §9A.3 declaration.

9A.3 **Derivation Exclusion Notice**: a derivative author may place a `TAP-EXCLUDE` marker file in the repository root, itemizing the specific parts **not open to the original author's drawing**. **Objective granularity standard**: each item must contain — a file path (directory-level wildcards allowed, but with the affected function signatures or module mechanism names noted) + a one-sentence delimitation of scope. Declarations containing only functional descriptions (e.g., "core algorithm module") without file paths are **void**; blanket declarations ("the entire project", "all code") are void. Unlisted parts default to 9A.1/9A.2.

9A.3a **Non-excludable zone** (tap's floor — the following can never be covered by a TAP-EXCLUDE declaration; any attempt is void):

  a) **Security fixes and vulnerability patches**: fixes for security vulnerabilities, crashes, or data corruption in code originating from the Work — freely absorbable by the original author into the mainline (the expression layer may be independently rewritten; the idea layer is open outright). Security has no private territory. **Repair test (anti-disguise)**: a change is a "repair" if and only if — the module's **user-visible function point** set (§5.5 function measure, with the two-way splitting bar) after the change is a **subset of or equal to** its pre-change set (repairs must not add user-nameable capabilities; behavioral hardening is not addition — is strengthening "password verification" into "password verification + 2FA" hardening or a new function point? **By the §5.5 test question: can the user have the old capability without the new behavior** — if the new behavior can be turned off (2FA optional) = behavioral hardening (may be part of a repair); if it cannot = new function point (not a repair)).

  b) **Thought-protection improvements**: any enhancement to the implementation of §9 (boundary implementation, leak fixes) — thought protection is tap's constitution; ideas that reinforce it cannot be kept from the original author.

  c) **Interoperability fixes**: adaptation logic fixing interface compatibility with the Work or its ecosystem.

  d) **Bug reports, issues, reproduction steps, test cases**: defect evidence belongs to the public layer by nature (they describe **the Work's problems**, not the derivative author's creations).

  e) **Metrics and benchmark data**: performance measurements of the Work or its components — numbers have no copyright territory (expression layer untouched; idea layer open).

**Design logic**: the non-excludable zone = "obligations the derivative inherited from the Work" + "repairs of the Work's defects". The former's hardening ideas cannot lock out the original author (else 9.5's obligations-follow-distribution would be hollowed); the latter was owed to the Work to begin with. **The derivative author's true private domain = their own original increments** (new functions, new mechanisms, new designs) — that is what 9A.3 protects.

9A.4 **Symmetry and respect**: this clause and §4 copyleft run in opposite directions with the same spirit — copyleft feeds derivatives back into the code pool; 9A feeds ideas back to the original author — but **code and patents are the derivative author's private property**, and the original author is equally barred at that gate. tap protects "each gatekeeper of thought and expression".

  **Manner of Absorption** — the original author, exercising 9A.1, must:
  a) **Source acknowledgment**: when absorbing an idea originating from a specific derivative into a mainline release, mark "inspired by [derivative name] (author/link)" in the changelog or release notes; unless the author or work is genuinely unlocatable. **This is a duty, not a courtesy** — acknowledgment makes absorption visible; visibility makes contribution accumulable (the contributor's résumé appreciates accordingly);
  b) **Positive absorption**: record borrowings in an acknowledging form ("this design comes from the community's X"); absorbing in a disparaging form ("fixed X's design flaw") is prohibited — technical correction is fine; erasure of origin is not;
  c) **Absorption restraint** (concrete test) — the original author's idea absorption from **the same derivative/extension** must satisfy all of:
  - c1) **Rate cap**: within any rolling 12-month period, the number of mainline releases absorbing that work's ideas ≤ that work's releases in the same period × 2 + 1 (e.g., they release 3 versions a year → at most 7 absorption-releases);
  - c2) **Lag window**: after the other side's idea enters one of their releases, the corresponding mainline absorption-release comes **no earlier than 30 days thereafter** (not racing the other side's release window; first-mover advantage gets its cashing period). **Emergency exemption**: where the absorbed content is a security fix (by the 9A.3a test) or a crash fix, the lag window does not apply — security does not queue;
  - c3) **Preemption bar and source priority** (two-way anti-copy): the decision basis is not "who released first" but "**the timestamp of the idea's first public expression**". **Four requirements of "public expression"**: a) **publicity** — accessible to unspecified third parties without login or authorization (public repositories, releases, public issues — private branches/internal documents do not count); b) **timestamp authority** — **third-party platform server time** prevails (hosting-platform commit/release/tag times); locally forgeable machine times (local `git commit --date`, file mtime) carry no authority; where in doubt, trusted timestamping (RFC 3161) or notarization governs; c) **substantive content** — expresses the substance of the idea (not a title placeholder); d) **persistence** — continuously accessible from the expression point onward (deleted-right-after-publish counts as "never public" — anti flash-publish sprinting). **All four together constitute "first public expression"**; content in private channels counts from the moment it becomes public (retroactive private timestamps are void). Hence: i) a derivative author preemptively publishing an idea learned from the Work's public channels — the first expression is on the Work's side, the derivative author may claim none of 9A.4's protections (attribution/rate/lag all inapplicable), and the Work's subsequent release of the same idea is not "absorption"; ii) the original author publishing an idea before any public expression by the derivative — likewise not an absorption; iii) where both sides independently and publicly expressed first, each holds their own expression. **Preemptively publishing an idea already present in someone's public channels earns the implementation right (lawful), not the status of "the absorbed" (not established)**;
  - c4) **Claim procedure**: the absorbed party claiming violation proceeds under 9A.9 due process (the evidence is the comparison of release records: both sides' changelogs and release timestamps are objective grounds); remedy on establishment = that absorption-release must remove idea-content other than the source acknowledgment, and restore compliance in the next release.

9A.5 **Verification duty**: a derivative distributed with a TAP-EXCLUDE declaration must note its existence prominently in the README or documentation; hidden declarations forfeit 9A.2.c protection.

9A.6 **Origin Exclusion**: the copyright holder may place a `TAP-ORIGIN-EXCLUDE` marker file in the repository root, itemizing derivative-work sources (project/repository granularity) **not accepted for 9A.1 idea feedback**. Listed derivatives receive no 9A.1 benefit but **remain bound by 9A.2** — the original author neither takes their ideas nor touches their code; both sides stay clean (a defensive clause: for malicious forks, cybersquatting derivatives, or license-breaching derivatives, the original author may unilaterally sever association without itemized proof). The excluded party's 9A.3a non-excludable obligations are not released.

9A.7 **License Revocation**: the copyright holder may, via a `TAP-REVOKED` marker file (placed in the official repository root and publicly displayed), itemize revocations of the **non-commercial grant** to specific derivatives or entities. Conditions: a) the derivative or entity breaches any clause of this license (including attribution, relicensing lock, Thought Materials obligations); b) revocation **does not affect the accrued use of the derivative's existing users** (copies already obtained remain valid under the license as of their acquisition; revocation operates prospectively only); c) **minimum standard of the revocation designation**: itemized — the specific clause number + supporting conduct (with a publicly verifiable evidence locator: repository path / commit hash / release link / notarized material, any one) + time of conduct. **A designation with clause numbers but no evidence locator is void**, and the revoked party may invoke this sub-clause directly as a defense; d) the revoked party may appeal once in writing to the copyright holder; revocation is stayed pending appeal; e) **reverse liability for abusive revocation**: where revocation is overturned on appeal or due process, the initiator compensates under §13 all reasonable losses caused by the revocation (including provable user attrition), and **the same allegation may not be used again for revocation** (no re-litigation of the same matter). **The price of revocation**: where revocation follows from breach, the derivative author compensates under §13 the copyright holder's reasonable costs.

9A.8 **Non-Interference**: the original author (copyright holder) **may not** interfere with, harass, or force the shutdown of any compliant Extension Work or derivative; technical means (interface changes, license revocation, compatibility sabotage) must not disturb normal users' use of that extension or derivative. **The only two exceptions**:

  a) the extension/derivative breaches any clause of this license;
  b) the extension/derivative breaches **extension rules expressly declared in the main work** (Extension Policy — it must exist as distributed with the Work and have been in effect **before** that extension's release — **no ad-hoc additions**: rules added after the fact to target a specific extension have no retroactive force against it).

  On either exception being met, the original author may report to distribution channels (plugin marketplaces, code hosting platforms, etc.) and demand delisting, the report itemizing the violation (which clause, what conduct, evidence).

  **Reciprocal reporting**: extension/derivative authors enjoy **fully symmetric reporting rights against the main author** — where the main author breaches this license (including 9A.8 interference, 9A.7 abusive revocation, 5.4 dilution) or abuses the Extension Policy (e.g., ad-hoc rules targeting a specific extension), the extension/derivative author may report to the same distribution channels and demand corresponding measures against the main work. **tap's enforcement is symmetric** — who is the author does not decide who is right; breach of the license does.

9A.9 **Due Process**: any delisting demand (by whomever initiated) must pass the distribution channel's formal review (whether the designation is specific, whether the evidence stands) before execution; the reported party has the right to a public rebuttal in the same channel. **Evidence verification duty**: formal review must include a **truthfulness spot-check** of the evidence locator (actually retrieve the cited content per the locator and compare against the allegation — locator present but content mismatching the allegation = invalid designation + malicious report); where content cannot be retrieved per the locator (404 / deleted / permission wall), the accusing party must supply a notarized copy, else the designation is void. Malicious reporting (knowing there is no breach, or forging/tampering with evidence, intending to suppress competition): the initiator compensates the reported party's reasonable losses under §13; **forged evidence voids the no-re-litigation shield** — the forgery itself is a new, independent breach ground, separately actionable.

## 10. Contributions

10.1 Contributors retain copyright in their contributions but grant the copyright holder perpetual, worldwide, royalty-free, sublicensable rights to use, modify, and distribute.

10.2 Contribution, once merged into the main repository, is deemed consent to distribution under this license.

## 11. Patents

11.1 Each recipient receives a non-exclusive, worldwide, royalty-free patent license, limited to claims necessarily infringed by implementing the Work.

11.2 **Retaliatory termination**: initiating patent litigation against any entity (alleging the Work or its derivatives infringe) terminates the 11.1 grant.

## 12. Termination

12.1 Breach of any clause of this license terminates all grants **automatically**.

12.2 Compliance responsibility for already-distributed copies rests with the distributor.

## 13. Indemnification

13.1 A recipient whose breach of this license exposes the copyright holder to third-party claims, litigation costs, or losses must compensate the copyright holder for all reasonable costs arising therefrom.

## 14. Disclaimer and Non-Waiver

14.1 The Work is provided "AS IS", without warranty of any kind.

14.2 **Non-waiver**: the copyright holder's failure to pursue any particular breach does not waive future enforcement of any right or clause.

14.3 Severability: invalidity of a single clause does not affect the rest; the invalid clause is to be reconstructed in the manner closest to its original intent.

## 15. Governing Law

15.1 This license is governed by `[TO BE DECIDED: PRC law / California law / Singapore law]`. `[TO BE DECIDED: forum]`

## 16. Entire Agreement and Authoritative Text

16.1 This license constitutes the entire agreement; any exception or additional grant must be made in writing by the copyright holder.

16.2 **Authoritative text**: the **Chinese text** is the sole authoritative version (the English translation is a reference only and does not constitute an independent grant basis); an English version issued by the copyright holder must be a **clause-by-clause parallel translation** declared "equivalent in meaning to the Chinese authoritative text" — in semantic conflict, the Chinese text governs. The key semantic anchors (§1.2a code/thought boundary, §9.3b systematicity test, §5.5 function point definition) **must not be simplified, paraphrased, or omitted** in the translation; a translation missing any anchor has no reference effect.
