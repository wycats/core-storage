# Branch copy-on-write

With only a single branch, each mutation creates a new revision, and each entity remembers the revision it was last mutated.

The possible mutations are:

- insert (insert a new record with all of its fields)
- patch (update some of the fields)
- delete (delete a record)

With multiple branches, the semantics we want are:

- each branch is forked off of the revision at the time of the branch
- if an entity hasn't changed since the branch point, no copies are made
- if an entity changes on the parent branch and its original revision is before
  at least one branch, the entity is snapshotted
- snapshots are indexed by the revision number of the snapshot
- when a branch checks out an entity, it asks for the entity as of its branch
  point, which makes use of the copy-on-write semantics
- the tag for a branch's checked out entities should produce:
  - if the branch hasn't modified the entities, the branch's version (in theory
    a branch could return an early value, but since tags only matter in order
    to determine whether some entity has changed since it was checked out, earlier
    revisions are irrelevant)
  - if the branch has modified the entities, the mutation timestamp of the change
    made to the branch
- when a branch inserts an entity, its parent is the branch, and it shadows the
  original entity
- when a branch patches an entity, the original entity is copied to the branch and
  the patches are applied
- when a branch deletes an entity, a tombstone is inserted in the branch
