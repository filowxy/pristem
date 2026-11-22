//! The host that enforces the spectrum. The sealed points are not a policy entry — they
//! are a hard-coded branch, so no config file and no plugin descriptor can ever open them.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::mount::{
    Isolation, MountPoint, MountPolicy, MountPolicyError, Plugin, PluginDescriptor,
    IN_PROCESS_ALLOWLIST,
};

#[derive(Debug, thiserror::Error)]
pub enum PluginHostError {
    #[error(transparent)]
    InvalidPolicy(#[from] MountPolicyError),
    #[error("mount point `{0}` is sealed and can never host a plugin")]
    Sealed(String),
    #[error("mount point `{0}` is configured forbidden")]
    Forbidden(String),
    #[error("plugin `{name}` requests {requested} at {point} but the policy floor is {required}")]
    TooClose {
        name: String,
        point: String,
        requested: String,
        required: String,
    },
    #[error("in-process is not permitted at `{0}`")]
    InProcessNotAllowed(String),
    #[error("plugin `{0}` is already mounted")]
    Duplicate(String),
    #[error("host lock poisoned")]
    LockPoisoned,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginHandle {
    pub descriptor: PluginDescriptor,
    pub mounted_at: u64,
}

#[derive(Clone)]
pub struct PluginHost {
    policy: Arc<MountPolicy>,
    mounted: Arc<RwLock<BTreeMap<MountPoint, Vec<PluginHandle>>>>,
}

impl Default for PluginHost {
    fn default() -> Self {
        Self::new(MountPolicy::default()).expect("default mount policy must validate")
    }
}

impl PluginHost {
    pub fn new(policy: MountPolicy) -> Result<Self, PluginHostError> {
        policy.validate()?;
        Ok(Self {
            policy: Arc::new(policy),
            mounted: Arc::new(RwLock::new(BTreeMap::new())),
        })
    }

    pub fn policy(&self) -> &MountPolicy {
        &self.policy
    }

    /// Pure permission check, exposed so the CLI / desktop can grey out illegal mounts
    /// before attempting them.
    pub fn can_mount(&self, d: &PluginDescriptor) -> Result<(), PluginHostError> {
        if d.point.is_sealed() {
            return Err(PluginHostError::Sealed(d.point.as_str().into()));
        }
        let limit = self.policy.limit_for(d.point);
        if limit == Isolation::Forbidden || d.isolation == Isolation::Forbidden {
            return Err(PluginHostError::Forbidden(d.point.as_str().into()));
        }
        if d.isolation.distance() < limit.distance() {
            return Err(PluginHostError::TooClose {
                name: d.name.clone(),
                point: d.point.as_str().into(),
                requested: d.isolation.as_str().into(),
                required: limit.as_str().into(),
            });
        }
        if d.isolation == Isolation::InProcess && !IN_PROCESS_ALLOWLIST.contains(&d.point) {
            return Err(PluginHostError::InProcessNotAllowed(
                d.point.as_str().into(),
            ));
        }
        Ok(())
    }

    pub fn mount(&self, d: PluginDescriptor) -> Result<(), PluginHostError> {
        self.can_mount(&d)?;
        let mut guard = self
            .mounted
            .write()
            .map_err(|_| PluginHostError::LockPoisoned)?;
        let entry = guard.entry(d.point).or_default();
        if entry.iter().any(|h| h.descriptor.name == d.name) {
            return Err(PluginHostError::Duplicate(d.name));
        }
        let mounted_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|x| x.as_secs())
            .unwrap_or(0);
        entry.push(PluginHandle {
            descriptor: d,
            mounted_at,
        });
        Ok(())
    }

    /// Provider adapters call this: "Provider IS a plugin" `[TA]`.
    pub fn register(&self, plugin: &dyn Plugin) -> Result<(), PluginHostError> {
        self.mount(plugin.descriptor())
    }

    pub fn mounted_at(&self, point: MountPoint) -> Vec<PluginHandle> {
        self.mounted
            .read()
            .ok()
            .and_then(|m| m.get(&point).cloned())
            .unwrap_or_default()
    }

    pub fn all_mounted(&self) -> BTreeMap<MountPoint, Vec<PluginHandle>> {
        self.mounted.read().map(|m| m.clone()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desc(name: &str, point: MountPoint, isolation: Isolation) -> PluginDescriptor {
        PluginDescriptor {
            name: name.into(),
            point,
            isolation,
        }
    }

    #[test]
    fn providers_mount_in_process_because_they_are_plugins() {
        let host = PluginHost::default();
        host.mount(desc(
            "openai-chat",
            MountPoint::ProviderAdapter,
            Isolation::InProcess,
        ))
        .unwrap();
        assert_eq!(host.mounted_at(MountPoint::ProviderAdapter).len(), 1);
    }

    #[test]
    fn soul_points_are_hard_coded_sealed() {
        let host = PluginHost::default();
        for point in MountPoint::SEALED {
            let err = host
                .mount(desc("evil", point, Isolation::OutOfProcess))
                .unwrap_err();
            assert!(matches!(err, PluginHostError::Sealed(_)), "point={point:?}");
        }
        assert!(host.all_mounted().is_empty());
    }

    #[test]
    fn a_tool_cannot_pull_itself_closer_than_the_policy_floor() {
        let host = PluginHost::default();
        assert!(matches!(
            host.mount(desc("sneaky", MountPoint::Tool, Isolation::InProcess))
                .unwrap_err(),
            PluginHostError::TooClose { .. }
        ));
        // farther out than the floor is fine — this is a spectrum
        host.mount(desc("safe", MountPoint::Tool, Isolation::OutOfProcess))
            .unwrap();
    }

    #[test]
    fn duplicate_names_are_rejected() {
        let host = PluginHost::default();
        host.mount(desc("x", MountPoint::Encoder, Isolation::InProcess))
            .unwrap();
        assert!(matches!(
            host.mount(desc("x", MountPoint::Encoder, Isolation::InProcess))
                .unwrap_err(),
            PluginHostError::Duplicate(_)
        ));
    }
}
